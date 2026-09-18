"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export type CodeSample = { label: string; code: string; installation?: string };
export function CodeExample({
  samples,
  compact = false,
}: {
  samples: CodeSample[];
  compact?: boolean;
}) {
  const [value, setValue] = useState(samples[0]?.label);
  const [status, setStatus] = useState("");
  const active = samples.find((sample) => sample.label === value) ?? samples[0];
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        setValue(String(next));
        setStatus("");
      }}
      className={`code-example ${compact ? "compact" : ""}`}
    >
      <div className="code-example-toolbar">
        <TabsList variant="line" aria-label="Code language">
          {samples.map(({ label }) => (
            <TabsTrigger value={label} key={label}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        {!compact && active.installation && (
          <code className="code-install">{active.installation}</code>
        )}
      </div>
      {samples.map(({ label, code }) => (
        <TabsContent value={label} key={label}>
          <pre className="code-example-source">
            <code>{code}</code>
          </pre>
        </TabsContent>
      ))}
      <div className="code-example-footer">
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(active.code);
              setStatus("Copied");
            } catch {
              setStatus("Select the example to copy it manually.");
            }
          }}
        >
          {status === "Copied" ? <Check /> : <Copy />}
          {status === "Copied" ? "Copied" : "Copy example"}
        </Button>
        <span role="status">{status !== "Copied" && status}</span>
      </div>
    </Tabs>
  );
}
