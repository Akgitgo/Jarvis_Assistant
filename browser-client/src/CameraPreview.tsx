import { useEffect, useRef } from 'react';

interface CameraPreviewProps {
  /** The hidden source video managed by GestureTrailCanvas. */
  sourceVideo: HTMLVideoElement | null;
}

/**
 * CameraPreview — floating webcam thumbnail (bottom-centre).
 *
 * Mirrors the MediaStream from sourceVideo into its own <video> element so
 * the camera is opened only once (no second getUserMedia call).
 * pointer-events: none — does not block underlying interactions.
 */
export function CameraPreview({ sourceVideo }: CameraPreviewProps) {
  const previewRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const preview = previewRef.current;
    if (!preview || !sourceVideo) return;

    const attach = () => {
      const stream = sourceVideo.srcObject as MediaStream | null;
      if (stream && preview.srcObject !== stream) {
        preview.srcObject = stream;
        preview.play().catch(() => {});
      }
    };

    attach();

    // sourceVideo may not have a stream yet — poll briefly
    const interval = setInterval(() => {
      if (sourceVideo.srcObject) {
        attach();
        clearInterval(interval);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [sourceVideo]);

  return (
    <video
      ref={previewRef}
      muted
      playsInline
      style={{
        position: 'fixed',
        bottom: '16px',
        left: '50%',
        transform: 'translateX(-50%) scaleX(-1) translateZ(0)',
        willChange: 'transform',
        backfaceVisibility: 'hidden',
        width: '320px',
        height: '240px',
        objectFit: 'cover',
        borderRadius: '8px',
        border: '1px solid rgba(0, 229, 255, 0.45)',
        boxShadow: '0 0 12px rgba(0, 229, 255, 0.2)',
        zIndex: 9995,
        opacity: 0.85,
        pointerEvents: 'none',
        background: '#000',
      }}
    />
  );
}
