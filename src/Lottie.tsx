import React from "react";

type LottieProps = {
  src: string;
  className?: string;
  loop?: boolean;
  autoplay?: boolean;
};

export const Lottie = ({
  src,
  className,
  loop = false,
  autoplay = true,
}: LottieProps) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    let anim: { destroy?: () => void } | null = null;

    const run = async () => {
      const mod = await import("lottie-web");
      const lottie: any = (mod as any).default ?? mod;

      const res = await fetch(src);
      if (!res.ok) throw new Error(`Failed to fetch lottie: ${res.status}`);
      const data = (await res.json()) as unknown;

      if (cancelled) return;
      if (!containerRef.current) return;

      anim = lottie.loadAnimation({
        container: containerRef.current,
        renderer: "svg",
        loop,
        autoplay,
        animationData: data,
        rendererSettings: {
          preserveAspectRatio: "xMidYMid meet",
        },
      });

      try {
        console.log("[linky] Lottie loaded", { src });
      } catch {
        // ignore
      }
    };

    run().catch((err) => {
      // Best-effort: if Lottie fails, we just show nothing.
      try {
        console.warn("[linky] Failed to load lottie", err);
      } catch {
        // ignore
      }
    });

    return () => {
      cancelled = true;
      try {
        anim?.destroy?.();
      } catch {
        // ignore
      }
    };
  }, [autoplay, loop, src]);

  return <div className={className} ref={containerRef} />;
};

export default Lottie;
