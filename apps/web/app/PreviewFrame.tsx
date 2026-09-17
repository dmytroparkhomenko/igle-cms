"use client";

import { useEffect, useRef, useState, type CSSProperties, type Ref } from "react";

type Viewport = "desktop" | "mobile";

// Real device dimensions, not "whatever room happens to be available" — a 1440x900 laptop
// viewport and a 390x844 iPhone viewport, each scaled via container-query units to fit
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
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [isFullscreen, setIsFullscreen] = useState(false);

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
      <div className={`preview-frame-body ${viewport === "mobile" ? "is-mobile" : ""}`}>
        <div
          className="preview-frame-device"
          style={{ ["--device-w" as string]: size.width, ["--device-h" as string]: size.height }}
        >
          <iframe key={reloadKey} ref={frameRef} src={src} title={title} onLoad={onIframeLoad} />
        </div>
      </div>
    </div>
  );
}
