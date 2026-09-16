import type { Character } from "./character-types";
import { loadWorldBooks, saveWorldBooks, parseWorldBookFromJson, loadBindingConfig, saveBindingConfig, getCharacterBinding, setCharacterBinding, resolveBinding } from "./settings-storage";

/** Only called once the user places an imported character on the canvas. */
export function importCharacterWorldBook(character: Character): void {
    const card = character.importedCard;
    if (!card) return;
    const source = (card.data && typeof card.data === "object" ? card.data : card) as Record<string, unknown>;
    if (!source.character_book) return;
    const book = parseWorldBookFromJson(JSON.stringify(source.character_book));
    if (!book) return;
    book.id = `imported-worldbook-${character.id}`;
    if (!book.name || book.name === "导入的世界书") book.name = `${character.name}的世界书`;
    const books = loadWorldBooks();
    if (!books.some(b => b.id === book.id)) saveWorldBooks([...books, book]);
    const config = loadBindingConfig();
    const binding = getCharacterBinding(config, character.id);
    const inherited = resolveBinding(config, character.id, "chat").worldBookIds || [];
    binding.defaults = { ...binding.defaults, worldBookIds: [...new Set([...inherited, book.id])] };
    saveBindingConfig(setCharacterBinding(config, binding));
}
