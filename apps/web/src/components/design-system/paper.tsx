import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function Stamp({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={cn("paper-stamp", className)}>{children}</span>;
}
export function PaperPanel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("paper-panel", className)}>
      <CardHeader className="paper-panel-heading">
        <CardTitle>{title}</CardTitle>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
export function Metric({
  label,
  value,
  description,
  icon,
}: {
  label: string;
  value: ReactNode;
  description: string;
  icon: ReactNode;
}) {
  return (
    <Card className="paper-metric">
      <div className="paper-metric-label">
        {label}
        {icon}
      </div>
      <strong>{value}</strong>
      <p>{description}</p>
    </Card>
  );
}
export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Guilloche({ className, ...props }: ComponentProps<"svg">) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 600 600"
      fill="none"
      className={cn("guilloche", className)}
      {...props}
    >
      <g transform="translate(300 300)">
        {Array.from({ length: 18 }, (_, i) => (
          <ellipse key={i} rx="270" ry="110" transform={`rotate(${i * 10})`} />
        ))}
      </g>
    </svg>
  );
}
