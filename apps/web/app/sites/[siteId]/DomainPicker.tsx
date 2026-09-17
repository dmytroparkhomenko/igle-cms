"use client";

import { useState } from "react";

export function DomainPicker({
  initialValue,
  options
}: {
  initialValue: string;
  options: Array<{ id: number; domain: string }>;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <>
      <input type="text" id="domain" name="domain" value={value} onChange={(event) => setValue(event.target.value)} placeholder="example.com" />
      {options.length > 0 ? (
        <select
          aria-label="Pick a domain already on your aaPanel server"
          value=""
          onChange={(event) => {
            if (event.target.value) setValue(event.target.value);
          }}
          style={{ marginTop: 6 }}
        >
          <option value="">
            Or pick from {options.length} existing aaPanel domain{options.length === 1 ? "" : "s"}…
          </option>
          {options.map((option) => (
            <option key={option.id} value={option.domain}>
              {option.domain}
            </option>
          ))}
        </select>
      ) : null}
    </>
  );
}
