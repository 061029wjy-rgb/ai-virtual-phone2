import type { BindingConfig, BindingSlot, RegexRule } from "./settings-types";

/** Build display-only rules; literal mode never interprets a user's words as regex. */
export function createDisplayFilterRules(input: string, mode: "words" | "regex", id: string): RegexRule[] {
    let pattern: RegExp;
    if (mode === "words") {
        const words = [...new Set(input.split(/\r?\n/).map(word => word.trim()).filter(Boolean))];
        if (!words.length) throw new Error("请先填写要隐藏的字词，每行一个。");
        // Prefer the longest phrase when one entry is a prefix of another.
        words.sort((a, b) => b.length - a.length);
        pattern = new RegExp(words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
    } else {
        const source = input.trim();
        if (!source) throw new Error("请先填写正则表达式。");
        const wrapped = source.match(/^\/([\s\S]*)\/([a-z]*)$/i);
        try {
            pattern = wrapped ? new RegExp(wrapped[1], wrapped[2]) : new RegExp(source, "g");
        } catch {
            throw new Error("正则表达式无效，请检查括号、转义和 flags。");
        }
    }
    const scopes = [
        { name: "单聊", tags: ["chat", "text"] },
        { name: "群聊", tags: ["group_chat", "text"] },
        { name: "单聊线下", tags: ["chat", "offline"] },
        { name: "群聊线下", tags: ["group_chat", "offline"] },
    ];
    return scopes.map((scope, index) => ({
        id: `${id}-${index}`,
        scriptName: `隐藏 AI 正文（${scope.name}）`,
        findRegex: pattern.toString(),
        replaceString: "",
        disabled: false,
        placement: [2],
        tags: scope.tags,
        markdownOnly: true,
        promptOnly: false,
        runOnEdit: true,
    }));
}

/** Add to existing overrides as well, so an explicit character binding doesn't mask the filter. */
export function bindDisplayFilterToAllChats(config: BindingConfig, groupId: string): BindingConfig {
    const append = (slot: BindingSlot): BindingSlot => ({
        ...slot, regexIds: [...new Set([...(slot.regexIds || []), groupId])],
    });
    const override = (slot: BindingSlot): BindingSlot => slot.regexIds?.length ? append(slot) : slot;
    const overrides = (slots: Partial<Record<string, BindingSlot>>) => Object.fromEntries(
        Object.entries(slots).map(([app, slot]) => [app, slot ? override(slot) : slot]),
    );
    return {
        ...config,
        globalDefaults: append(config.globalDefaults),
        appDefaults: config.appDefaults ? overrides(config.appDefaults) : undefined,
        characterBindings: config.characterBindings.map(binding => ({
            ...binding,
            defaults: override(binding.defaults),
            appOverrides: overrides(binding.appOverrides),
        })),
    };
}
