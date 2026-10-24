"use client";

import { useEffect } from "react";

/** Tells the page that shows this survey inside a frame how tall it is, so the frame can fit it. */
export function EmbedHeight() {
  useEffect(() => {
    if (window.parent === window) return;
    // Measure the content itself, not the page: the page is at least as tall as the frame, so measuring it
    // would never let the frame shrink and could make it grow without end.
    const content = document.getElementById("main");
    if (!content) return;
    let last = 0;
    const send = () => {
      const height = Math.ceil(content.getBoundingClientRect().height);
      if (height === last) return;
      last = height;
      window.parent.postMessage(
        { type: "feedback-survey-height", height },
        "*",
      );
    };
    send();
    const ro = new ResizeObserver(send);
    ro.observe(content);
    return () => ro.disconnect();
  }, []);
  return null;
}
