type Point = {
  day: string;
  requests: number;
  quotes: number;
  messages: number;
};

const fmt = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

export function ActivityChart({
  series,
  days,
}: {
  series: Point[];
  days: number;
}) {
  const totals = series.reduce(
    (sum, p) => ({
      requests: sum.requests + p.requests,
      quotes: sum.quotes + p.quotes,
      messages: sum.messages + p.messages,
    }),
    { requests: 0, quotes: 0, messages: 0 },
  );
  const max = Math.max(
    1,
    ...series.flatMap((p) => [p.requests, p.quotes, p.messages]),
  );
  const width = 800;
  const height = 150;
  const x = (i: number) =>
    series.length <= 1 ? width / 2 : (i / (series.length - 1)) * width;
  const y = (value: number) => height - (value / max) * (height - 8);
  const line = (key: "requests" | "quotes" | "messages") =>
    series
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`,
      )
      .join(" ");

  const empty =
    totals.requests === 0 && totals.quotes === 0 && totals.messages === 0;
  const first = series[0]
    ? fmt.format(new Date(`${series[0].day}T00:00:00Z`))
    : "";
  const middle = series.length
    ? fmt.format(
        new Date(`${series[Math.floor(series.length / 2)].day}T00:00:00Z`),
      )
    : "";
  const last = series.length
    ? fmt.format(new Date(`${series[series.length - 1].day}T00:00:00Z`))
    : "";

  if (empty) {
    return (
      <p className="px-4 py-8 text-sm text-muted-foreground">
        Nothing new in the last {days} days. New requests, quotes and sent
        messages will appear here.
      </p>
    );
  }

  return (
    <div className="space-y-3 px-4 pb-4">
      <figure
        role="img"
        aria-label={`Daily activity over ${days} days: ${totals.requests} requests, ${totals.quotes} quotes and ${totals.messages} sent messages.`}
        className="space-y-2"
      >
        <div className="relative">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            className="h-40 w-full overflow-visible"
            aria-hidden="true"
          >
            {[0.25, 0.5, 0.75].map((f) => (
              <line
                key={f}
                x1="0"
                x2={width}
                y1={height * f}
                y2={height * f}
                stroke="var(--border)"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <line
              x1="0"
              x2={width}
              y1={height}
              y2={height}
              stroke="var(--border)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={line("messages")}
              fill="none"
              stroke="var(--hue-teal)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={line("quotes")}
              fill="none"
              stroke="var(--hue-amber)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={line("requests")}
              fill="none"
              stroke="var(--hue-blue)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {series.length <= 31
              ? series.flatMap((p, i) =>
                  (
                    [
                      ["requests", "var(--hue-blue)"],
                      ["quotes", "var(--hue-amber)"],
                      ["messages", "var(--hue-teal)"],
                    ] as const
                  ).map(([key, color]) => (
                    <circle
                      key={`${p.day}-${key}`}
                      cx={x(i)}
                      cy={y(p[key])}
                      r="2.5"
                      fill={color}
                    >
                      <title>
                        {`${fmt.format(new Date(`${p.day}T00:00:00Z`))}: ${p[key]} ${key}`}
                      </title>
                    </circle>
                  )),
                )
              : null}
          </svg>
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{first}</span>
          <span className="hidden sm:inline">{middle}</span>
          <span>{last}</span>
        </div>
      </figure>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
        <Legend color="bg-hue-blue" label="Requests" value={totals.requests} />
        <Legend color="bg-hue-amber" label="Quotes" value={totals.quotes} />
        <Legend color="bg-hue-teal" label="Messages" value={totals.messages} />
      </div>
    </div>
  );
}

function Legend({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span aria-hidden="true" className={`size-2 rounded-full ${color}`} />
      {label}{" "}
      <span className="font-medium text-foreground tabular-nums">{value}</span>
    </span>
  );
}
