export default async function Login({ searchParams }: { searchParams: Promise<{ bad?: string }> }) {
  const { bad } = await searchParams;
  return (
    <form className="login" action="/api/login" method="post">
      <h1>Team sign in</h1>
      <p className="muted">One password for editors and store managers.</p>
      {bad && <p style={{ color: "var(--fix)" }}>That password did not match. Check with SB.</p>}
      <input type="password" name="password" placeholder="Password" autoFocus required />
      <button type="submit">Open dashboard</button>
    </form>
  );
}
