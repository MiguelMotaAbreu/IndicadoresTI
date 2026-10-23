"use client";

import { ActivityIcon } from "@phosphor-icons/react";

export function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <div className={`brand${dark ? " brand--dark" : ""}`}>
      <span className="brand__mark"><ActivityIcon size={19} weight="bold" /></span>
      <span>
        <strong>Pulse</strong><em>TI</em>
      </span>
    </div>
  );
}
