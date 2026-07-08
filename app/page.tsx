export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-3)",
        textAlign: "center",
      }}
    >
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "var(--fs-display)",
          letterSpacing: "var(--tracking-display)",
          color: "var(--ink)",
          margin: 0,
        }}
      >
        数字生命摩斯
      </h1>
      <p
        style={{
          fontSize: "var(--fs-body)",
          color: "var(--muted)",
          margin: 0,
        }}
      >
        正式站建设中
      </p>
    </main>
  );
}
