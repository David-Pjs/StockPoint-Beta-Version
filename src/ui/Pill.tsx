type Props = {
  label: string;
  value: string;
  color?: "ok" | "bad";
};
export default function Pill({ label, value, color = "ok" }: Props) {
  return (
    <div className="kpi-tile">
      <div className="text-sm muted">{label}</div>
      <div className={`kpi-value ${color}`}>{value}</div>
    </div>
  );
}
