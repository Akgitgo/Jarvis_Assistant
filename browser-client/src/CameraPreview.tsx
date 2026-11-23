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
  const isDemo = new URLSearchParams(window.location.search).get('demo') === 'true';

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
    <div
      style={{
        position: 'fixed',
        bottom: '16px',
        left: '50%',
        transform: 'translateX(-50%) translateZ(0)',
        willChange: 'transform',
        backfaceVisibility: 'hidden',
        width: '320px',
        height: '240px',
        borderRadius: '8px',
        border: '1px solid rgba(0, 229, 255, 0.45)',
        boxShadow: '0 0 12px rgba(0, 229, 255, 0.2)',
        zIndex: 9995,
        opacity: 0.9,
        pointerEvents: 'none',
        background: '#030712',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {isDemo && !sourceVideo && (
        <div style={{ textAlign: 'center', padding: '16px' }}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>🤖</div>
          <div style={{ color: '#00d4ff', fontFamily: 'monospace', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px' }}>
            SIMULATION FEED
          </div>
          <div style={{ color: '#64748b', fontSize: '11px', marginTop: '6px' }}>
            Synthetic Hand Tracking Active
          </div>
        </div>
      )}
      <video
        ref={previewRef}
        muted
        playsInline
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: 'scaleX(-1)',
          display: isDemo && !sourceVideo ? 'none' : 'block',
        }}
      />
    </div>
  );
}
