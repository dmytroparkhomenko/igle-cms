"use client";

import { useEffect, useRef, useState, type CSSProperties, type Ref } from "react";

type Viewport = "desktop" | "mobile";

// Real device dimensions, not "whatever room happens to be available" — a 1440x900 laptop
// viewport and a 390x844 iPhone viewport, scaled (via ResizeObserver, see below) to fit
// whatever space the caller gives this component while staying proportionally accurate.
const DEVICE_SIZES: Record<Viewport, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 }
};

export function PreviewFrame({
  src,
  title,
  className,
  style,
  reloadKey,
  frameRef,
  onIframeLoad,
  hideFullscreenButton
}: {
  src: string;
  title: string;
  className?: string;
  style?: CSSProperties;
  reloadKey?: number;
  frameRef?: Ref<HTMLIFrameElement>;
  onIframeLoad?: () => void;
  hideFullscreenButton?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    function onChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current?.requestFullscreen();
    }
  }

  const size = DEVICE_SIZES[viewport];

  // Measuring the actual box (ResizeObserver) instead of CSS container-query size containment —
  // `container-type: size` needs both axes definite up front and, nested inside a flexing
  // sidebar layout, could settle into a relayout loop instead of a stable size. This is simple
  // arithmetic on a real measured box, so there's nothing for the browser to oscillate on.
  useEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      const next = Math.min(width / size.width, height / size.height);
      setScale(Number.isFinite(next) && next > 0 ? next : 1);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [size.width, size.height]);

  return (
    <div ref={containerRef} className={`preview-frame ${className ?? ""}`} style={style}>
      <div className="preview-frame-toolbar">
        <div className="preview-frame-viewport-toggle" role="group" aria-label="Preview viewport">
          <button type="button" aria-pressed={viewport === "desktop"} onClick={() => setViewport("desktop")}>
            Desktop
          </button>
          <button type="button" aria-pressed={viewport === "mobile"} onClick={() => setViewport("mobile")}>
            Mobile
          </button>
        </div>
        {hideFullscreenButton ? null : (
          <button type="button" className="preview-frame-fullscreen-btn" onClick={toggleFullscreen}>
            {isFullscreen ? "Exit full screen" : "Full screen"}
          </button>
        )}
      </div>
      <div ref={bodyRef} className={`preview-frame-body ${viewport === "mobile" ? "is-mobile" : ""}`}>
        <div
          className="preview-frame-device"
          style={{ width: size.width * scale, height: size.height * scale }}
        >
          <iframe
            key={reloadKey}
            ref={frameRef}
            src={src}
            title={title}
            onLoad={onIframeLoad}
            style={{ width: size.width, height: size.height, transform: `scale(${scale})` }}
          />
        </div>
      </div>
    </div>
  );
}
