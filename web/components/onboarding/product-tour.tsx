"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, X } from "lucide-react";
import {
  KEYS,
  tourSteps,
  writeFlag,
  type TourStep,
} from "@/lib/onboarding";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useFlag } from "./use-flag";

/** Other parts of the app start the tour by firing this on the window (the Help menu does). */
export const START_TOUR_EVENT = "onboarding:start-tour";

const CARD_W = 340;
const GAP = 14;
const PAD = 6;

/** The first spotlight target with that name that is actually on screen (a phone hides the sidebar). */
function findTarget(name: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`);
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

type Box = { top: number; left: number; width: number; height: number };

/**
 * A short guided tour of the workspace: one card at a time, a spotlight on the part of the screen it talks about,
 * and nothing that cannot be left at once. It starts by itself the first time someone opens the overview, and again
 * whenever they ask for it from the Help menu. Keyboard: arrows move, Enter goes on, Escape leaves. People who
 * prefer less motion get no animation (the global rule), and a screen reader hears each card as a dialog.
 */
export function ProductTour({
  workspaceId,
  available,
  canAdd,
}: {
  workspaceId: string;
  available: string[];
  canAdd: boolean;
}) {
  const pathname = usePathname();
  const seen = useFlag(KEYS.tour);
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  const [index, setIndex] = useState(0);
  const returnTo = useRef<HTMLElement | null>(null);
  const base = `/w/${workspaceId}`;

  const start = useCallback(() => {
    const wanted = tourSteps(available, canAdd).filter(
      (s) => !s.onlyWithTarget || (s.target && findTarget(s.target)),
    );
    returnTo.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setIndex(0);
    setSteps(wanted);
  }, [available, canAdd]);

  // On request, from the Help menu. A beat of delay lets the menu close and give the keyboard back first.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onStart = () => {
      clearTimeout(timer);
      timer = setTimeout(start, 120);
    };
    window.addEventListener(START_TOUR_EVENT, onStart);
    return () => {
      window.removeEventListener(START_TOUR_EVENT, onStart);
      clearTimeout(timer);
    };
  }, [start]);

  // By itself, once, on the overview: the page a person lands on first.
  const onOverview = pathname === base;
  useEffect(() => {
    if (seen !== null || !onOverview) return; // undefined: not read yet; "done": already seen
    const timer = setTimeout(start, 700);
    return () => clearTimeout(timer);
  }, [seen, onOverview, start]);

  const finish = useCallback(() => {
    writeFlag(KEYS.tour, "done");
    setSteps(null);
    const back = returnTo.current;
    returnTo.current = null;
    if (back?.isConnected) back.focus();
  }, []);

  if (!steps || steps.length === 0) return null;
  return (
    <TourCard
      steps={steps}
      index={Math.min(index, steps.length - 1)}
      setIndex={setIndex}
      finish={finish}
      base={base}
    />
  );
}

function TourCard({
  steps,
  index,
  setIndex,
  finish,
  base,
}: {
  steps: TourStep[];
  index: number;
  setIndex: (i: number) => void;
  finish: () => void;
  base: string;
}) {
  const router = useRouter();
  const step = steps[index];
  const last = index === steps.length - 1;
  const [box, setBox] = useState<Box | null>(null);
  const [view, setView] = useState({ w: 1024, h: 768 });
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  // Find the target, bring it into view, and follow it as the window changes.
  useEffect(() => {
    const target = step.target ? findTarget(step.target) : null;
    if (target) target.scrollIntoView({ block: "nearest", inline: "nearest" });
    const measure = () => {
      setView({ w: window.innerWidth, h: window.innerHeight });
      if (!target || !target.isConnected) return setBox(null);
      const r = target.getBoundingClientRect();
      setBox({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [step]);

  // Each card takes the keyboard, so Enter always means "next" and a screen reader starts at its title.
  useEffect(() => {
    nextRef.current?.focus();
  }, [index]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      finish();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (!last) setIndex(index + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (index > 0) setIndex(index - 1);
    } else if (e.key === "Tab") {
      // Keep the keyboard inside the card while it is open.
      const focusable = cardRef.current?.querySelectorAll<HTMLElement>(
        "button, a[href], [tabindex]:not([tabindex='-1'])",
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const end = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        end.focus();
      } else if (!e.shiftKey && document.activeElement === end) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  // Place the card beside its target when there is room, below it otherwise, and in the middle with no target.
  const cardW = Math.min(CARD_W, view.w - 32);
  let style: React.CSSProperties;
  if (box) {
    const roomRight = box.left + box.width + GAP + cardW <= view.w - 16;
    const left = roomRight
      ? box.left + box.width + GAP
      : Math.max(16, Math.min(box.left + box.width - cardW, view.w - cardW - 16));
    const top = roomRight
      ? Math.max(16, Math.min(box.top - 8, view.h - 300))
      : Math.min(box.top + box.height + GAP, view.h - 300);
    style = { top, left, width: cardW };
  } else {
    style = {
      top: "50%",
      left: "50%",
      width: cardW,
      transform: "translate(-50%, -50%)",
    };
  }

  const titleId = `tour-title-${step.id}`;
  const bodyId = `tour-body-${step.id}`;
  return (
    <div className="fixed inset-0 z-[70]" onKeyDown={onKeyDown}>
      {/* Blocks clicks on the page behind: a tour that lets you wander off mid-step loses its place. */}
      <div aria-hidden="true" className="absolute inset-0" />
      {box ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-lg ring-2 ring-sun transition-[top,left,width,height] duration-200 shadow-[0_0_0_100vmax_color-mix(in_oklab,var(--brand-1)_62%,transparent)]"
          style={{
            top: box.top - PAD,
            left: box.left - PAD,
            width: box.width + PAD * 2,
            height: box.height + PAD * 2,
          }}
        />
      ) : (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-brand-1/60"
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        style={style}
        className={cn(
          "absolute max-h-[calc(100svh-2rem)] overflow-y-auto rounded-xl border border-border bg-card p-5 text-card-foreground shadow-raised",
          "outline-none",
        )}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold tracking-widest text-muted-foreground uppercase">
            Step {index + 1} of {steps.length}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={finish}
            className="-mr-2"
          >
            <X aria-hidden="true" />
            <span className="sr-only">Skip the tour</span>
          </Button>
        </div>
        <h2 id={titleId} className="font-display text-lg font-bold">
          {step.title}
        </h2>
        <p id={bodyId} className="mt-1.5 text-sm text-muted-foreground">
          {step.body}
        </p>
        <div
          role="progressbar"
          aria-label="Tour progress"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={index + 1}
          className="mt-4 flex gap-1"
        >
          {steps.map((s, i) => (
            <span
              key={s.id}
              aria-hidden="true"
              className={cn(
                "h-1 flex-1 rounded-full",
                i <= index ? "bg-primary" : "bg-muted",
              )}
            />
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between gap-2">
          {index === 0 ? (
            <Button type="button" variant="ghost" size="sm" onClick={finish}>
              Skip tour
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIndex(index - 1)}
            >
              Back
            </Button>
          )}
          <div className="flex items-center gap-2">
            {last && step.action ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={finish}
              >
                Close
              </Button>
            ) : null}
            <Button
              ref={nextRef}
              type="button"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                if (!last) return setIndex(index + 1);
                finish();
                if (step.action) router.push(`${base}/${step.action.path}`);
              }}
            >
              {last
                ? (step.action?.label ?? "Done")
                : index === 0
                  ? "Show me around"
                  : "Next"}
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
