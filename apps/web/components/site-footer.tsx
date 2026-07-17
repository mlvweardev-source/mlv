export function SiteFooter() {
  return (
    <footer className="border-t bg-muted/40">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row">
        <p>MLV — Konveksi online untuk kaos, kemeja, hoodie, topi, dan tas.</p>
        <p>&copy; {new Date().getFullYear()} MLV Wear</p>
      </div>
    </footer>
  );
}
