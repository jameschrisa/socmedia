import { useState } from "react";
import { motion } from "framer-motion";
import type { PlatformConnection } from "@socmedia/shared";
import { useConnectionMutations } from "@/hooks/useConnections";
import { ConnectionCardFront } from "./ConnectionCardFront";
import { ConnectionCardBack } from "./ConnectionCardBack";

/**
 * 3D flip card: front shows live status + quick actions, back shows the
 * configuration form. Both faces share one perspective container so the
 * flip reads as a physical card turning over rather than a cross-fade.
 */
export function ConnectionCard({ connection }: { connection: PlatformConnection }) {
  const [flipped, setFlipped] = useState(false);
  // Mount the back face lazily on first "Configure" click and keep it mounted afterwards
  // so the flip animation always has both faces present, while tests can assert on the
  // back-face fields simply appearing in the DOM rather than reasoning about 3D transforms.
  const [everFlipped, setEverFlipped] = useState(false);
  const mutations = useConnectionMutations();

  const handleConfigure = () => {
    setEverFlipped(true);
    setFlipped(true);
  };

  return (
    <div data-testid={`connection-${connection.platform}`} style={{ perspective: 1800 }}>
      <motion.div
        className="preserve-3d relative min-h-[320px]"
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 28 }}
      >
        {/* Front face stays in normal flow so the card grows with its content (e.g. test results). */}
        <div className="relative backface-hidden" style={{ pointerEvents: flipped ? "none" : "auto" }}>
          <ConnectionCardFront connection={connection} mutations={mutations} onConfigure={handleConfigure} />
        </div>
        {everFlipped && (
          <div className="absolute inset-0 backface-hidden overflow-hidden" style={{ transform: "rotateY(180deg)" }}>
            <ConnectionCardBack connection={connection} mutations={mutations} onBack={() => setFlipped(false)} />
          </div>
        )}
      </motion.div>
    </div>
  );
}
