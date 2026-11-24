"use client";

import { useEffect, useId, useRef, useState } from "react";

/** One choice in a Select */
export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  /** Shown when no option matches `value` */
  placeholder?: string;
  /** For screen readers when there is no visible <label> */
  ariaLabel?: string;
  /** id for the trigger button, so a <label htmlFor> can point at it */
  id?: string;
  disabled?: boolean;
  /** Red border, for a field with a validation error */
  invalid?: boolean;
  onBlur?: () => void;
  /** Extra classes on the wrapper, e.g. a width */
  className?: string;
}

/**
 * A dropdown in the app's own styling, in place of the native <select>. Listbox semantics,
 * keyboard support (arrows, Home/End, Enter/Space, Escape) and closes on an outside click.
 */
export function Select({
  value,
  options,
  onChange,
  placeholder = "Choose…",
  ariaLabel,
  id,
  disabled = false,
  invalid = false,
  onBlur,
  className = "",
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  // Close on a click outside
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) {
        setOpen(false);
        onBlur?.();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, onBlur]);

  function openList() {
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function choose(index: number) {
    onChange(options[index].value);
    setOpen(false);
    button.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(i + 1, options.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(active);
        break;
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={wrapper} className={`relative ${className}`}>
      <button
        ref={button}
        id={id}
        type="button"
        role="combobox"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        onBlur={() => {
          if (!open) onBlur?.();
        }}
        className={`w-full min-h-[40px] flex items-center justify-between gap-3 pl-3.5 pr-3 py-2 rounded-lg border bg-surface-2 text-sm text-left transition-colors hover:bg-surface-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${
          invalid ? "border-red-400 dark:border-red-600" : open ? "border-ink-3" : "border-line"
        }`}
      >
        <span className={`truncate ${selected ? "" : "text-ink-3"}`}>{selected ? selected.label : placeholder}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className={`w-3.5 h-3.5 shrink-0 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute z-20 mt-1.5 w-full min-w-[180px] max-h-96 overflow-auto rounded-lg border border-line bg-surface-2 p-1 shadow-lg shadow-black/20"
        >
          {options.map((option, i) => {
            const isSelected = option.value === value;
            return (
              <li
                key={option.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={isSelected}
                onPointerEnter={() => setActive(i)}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
                className={`flex items-center justify-between gap-3 px-2.5 py-2 rounded-md text-sm cursor-pointer ${
                  i === active ? "bg-surface-3" : ""
                } ${isSelected ? "text-ink font-medium" : "text-ink-2"}`}
              >
                <span className="truncate">{option.label}</span>
                {isSelected && (
                  <svg aria-hidden="true" viewBox="0 0 16 16" className="w-3.5 h-3.5 shrink-0 text-cell">
                    <path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
