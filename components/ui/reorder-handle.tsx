"use client";

import { useRef, useState } from "react";
import { GripVertical } from "lucide-react";

export function moveItem<T>(items: T[], from: number, to: number): T[] {
    if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return items;
    const next = [...items];
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
}

/** Mouse, pen, touch and keyboard sorting, isolated from card click/swipe handlers. */
export function ReorderHandle({ group, id, ids, onMove }: {
    group: string; id: string; ids: string[]; onMove: (from: number, to: number) => void;
}) {
    const target = useRef(id);
    const [active, setActive] = useState(false);
    const [destination, setDestination] = useState("");
    return <button type="button" aria-label="拖动排序，或按上下方向键移动" title="拖动排序，或按上下方向键移动"
        className="shrink-0 p-2 cursor-grab touch-none rounded-lg" style={{ background: active ? "#ddd" : undefined }}
        onClick={e => { e.preventDefault(); e.stopPropagation(); }}
        onTouchStart={e => e.stopPropagation()}
        onKeyDown={e => {
            if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
            e.preventDefault(); e.stopPropagation();
            const from = ids.indexOf(id); onMove(from, from + (e.key === "ArrowUp" ? -1 : 1));
        }}
        onPointerDown={e => {
            if (e.button !== 0) return;
            e.preventDefault(); e.stopPropagation(); target.current = id;
            e.currentTarget.setPointerCapture(e.pointerId); setActive(true);
        }}
        onPointerMove={e => {
            if (!active) return;
            e.stopPropagation();
            const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-sort-group]");
            if (row?.dataset.sortGroup === group && row.dataset.sortId) {
                target.current = row.dataset.sortId;
                setDestination(`移动到第 ${ids.indexOf(target.current) + 1} 项`);
            }
            const scroller = e.currentTarget.closest<HTMLElement>(".page-body");
            if (scroller) {
                const rect = scroller.getBoundingClientRect();
                if (e.clientY < rect.top + 48) scroller.scrollBy(0, -16);
                if (e.clientY > rect.bottom - 48) scroller.scrollBy(0, 16);
            }
        }}
        onPointerUp={e => {
            e.stopPropagation();
            if (!active) return;
            setActive(false); setDestination("");
            onMove(ids.indexOf(id), ids.indexOf(target.current));
        }}
        onPointerCancel={() => { setActive(false); setDestination(""); }}
        onLostPointerCapture={() => setActive(false)}>
        <GripVertical size={16} />
        {active && <span role="status" className="text-xs">{destination || "拖到目标条目后松开"}</span>}
    </button>;
}
