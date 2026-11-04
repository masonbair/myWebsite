"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

// Reduced motion is handled by the [data-reveal] rule in globals.css; a JS check here would differ between server and client and break hydration.
export function Reveal({ index, className, children }: { index: number; className?: string; children: ReactNode }) {
  return (
    <motion.div
      data-reveal
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15 }}
      transition={{ duration: 0.7, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
