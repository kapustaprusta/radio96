import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { CheckIcon, ChevronDownIcon } from "../../components/Icons";

interface DeviceSelectProps {
  id: string;
  label: string;
  value: string;
  options: readonly { deviceId: string; label: string }[];
  disabled?: boolean;
  disabledLabel?: string;
  onChange: (deviceId: string) => void;
}

export function DeviceSelect({ id, label, value, options, disabled = false, disabledLabel, onChange }: DeviceSelectProps) {
  const listId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef({ text: "", time: 0 });
  const [menu, setMenu] = useState<{ activeIndex: number; above: boolean; maxHeight: number } | null>(null);
  const expanded = menu !== null && !disabled;
  const selectedIndex = Math.max(0, options.findIndex((option) => option.deviceId === value));
  const activeIndex = Math.min(menu?.activeIndex ?? selectedIndex, options.length - 1);

  useEffect(() => {
    if (!expanded) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setMenu(null);
    };
    const closeOnResize = () => setMenu(null);
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("resize", closeOnResize);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [expanded]);

  useEffect(() => {
    if (expanded) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [expanded, activeIndex, listId]);

  const openMenu = (index = selectedIndex) => {
    const bounds = root.current?.getBoundingClientRect();
    const dialogBounds = root.current?.closest("[role=dialog]")?.getBoundingClientRect();
    const below = (dialogBounds?.bottom ?? window.innerHeight) - (bounds?.bottom ?? 0) - 15;
    const above = (bounds?.top ?? 0) - (dialogBounds?.top ?? 0) - 15;
    const desiredHeight = Math.min(240, options.length * 45 + 11);
    const placeAbove = below < desiredHeight && above > below;
    search.current = { text: "", time: 0 };
    setMenu({ activeIndex: index, above: placeAbove, maxHeight: Math.max(42, Math.min(240, placeAbove ? above : below)) });
  };

  const choose = (index: number) => {
    const choice = options[index];
    setMenu(null);
    trigger.current?.focus();
    if (choice && choice.deviceId !== value) onChange(choice.deviceId);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || options.length === 0) return;
    if (event.key === "Escape" && expanded) {
      event.preventDefault();
      event.stopPropagation();
      setMenu(null);
    } else if (event.key === "Tab") {
      setMenu(null);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (expanded) choose(activeIndex);
      else openMenu();
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      let nextIndex = expanded ? activeIndex : selectedIndex;
      if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = options.length - 1;
      else if (expanded) nextIndex = Math.max(0, Math.min(options.length - 1, nextIndex + (event.key === "ArrowDown" ? 1 : -1)));
      if (expanded) setMenu((current) => current && { ...current, activeIndex: nextIndex });
      else openMenu(nextIndex);
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const time = Date.now();
      const text = (time - search.current.time < 700 ? search.current.text : "") + event.key.toLocaleLowerCase();
      const nextIndex = options.findIndex((option) => option.label.toLocaleLowerCase().startsWith(text));
      if (nextIndex !== -1) {
        if (expanded) setMenu((current) => current && { ...current, activeIndex: nextIndex });
        else openMenu(nextIndex);
      }
      search.current = { text, time };
    }
  };

  return (
    <div className="device-select" ref={root} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setMenu(null);
    }}>
      <button className="device-select__trigger" id={id} ref={trigger} type="button" role="combobox"
        aria-label={label} aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
        aria-activedescendant={expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        disabled={disabled || options.length === 0} onKeyDown={handleKeyDown}
        onClick={() => { if (expanded) setMenu(null); else openMenu(); }}>
        <span className="device-select__label">
          {disabled && disabledLabel !== undefined ? disabledLabel : options[selectedIndex]?.label}
        </span>
        <span className="device-select__chevron"><ChevronDownIcon /></span>
      </button>
      {expanded && (
        <div className="device-select__options" id={listId} role="listbox" aria-label={label}
          data-placement={menu.above ? "above" : "below"} style={{ maxHeight: menu.maxHeight }}>
          {options.map((option, index) => (
            <div className="device-select__option" id={`${listId}-${index}`} key={option.deviceId} role="option"
              aria-selected={option.deviceId === value} data-active={index === activeIndex}
              onPointerMove={() => setMenu((current) => current && { ...current, activeIndex: index })}
              onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)}>
              <span className="device-select__label">{option.label}</span><CheckIcon />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
