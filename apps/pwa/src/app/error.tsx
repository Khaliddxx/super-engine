"use client";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-8 text-center">
      <div>
        <h1 className="text-2xl font-serif mb-2">Something broke</h1>
        <p className="text-muted mb-4">{error.message}</p>
        <button className="btn-primary" onClick={reset}>Try again</button>
      </div>
    </main>
  );
}
