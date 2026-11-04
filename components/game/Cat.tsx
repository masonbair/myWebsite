import type { CSSProperties } from "react";
import styles from "./Cat.module.css";

/** The 10-stage cat, drawn in CSS; `stage` 0..10 decides which features show. */
export function Cat({ stage, color }: { stage: number; color: string }) {
  const stageClasses = Array.from({ length: stage }, (_, i) => styles[`s${i + 1}`]).join(" ");
  return (
    <div data-cat data-stage={stage} className={`${styles.cat} ${stageClasses}`} style={{ "--cat": color } as CSSProperties}>
      <div className={`${styles.feature} ${styles.aura}`} />
      <div className={styles.body} />
      <div className={styles.head}>
        <div className={`${styles.feature} ${styles.ears}`}>
          <div className={styles.ear} />
          <div className={styles.ear} />
        </div>
        <div className={`${styles.feature} ${styles.eyes}`}>
          <div className={styles.eye} />
          <div className={styles.eye} />
        </div>
        <div className={`${styles.feature} ${styles.nose}`} />
        <div className={`${styles.feature} ${styles.whiskers}`}>
          <div className={styles.whisker} />
          <div className={styles.whisker} />
          <div className={styles.whisker} />
          <div className={styles.whisker} />
        </div>
        <div className={`${styles.feature} ${styles.spots}`} />
        <div className={`${styles.feature} ${styles.crown}`} />
        <div className={`${styles.feature} ${styles.wings}`} />
        <div className={`${styles.feature} ${styles.sparkles}`} />
      </div>
      <div className={`${styles.feature} ${styles.tail}`} />
    </div>
  );
}
