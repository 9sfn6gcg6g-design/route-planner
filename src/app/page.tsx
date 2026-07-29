import Planner from './planner'

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-5 py-14 sm:py-20">
      <header className="flex flex-col gap-4 border-b border-rule pb-8">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.22em] text-accent-ink">
          Session-aware routes
        </p>
        <h1 className="font-serif text-4xl font-normal leading-[1.05] tracking-tight sm:text-5xl">
          Route <em className="text-accent">Planner</em>
        </h1>
        <p className="max-w-prose text-base leading-relaxed text-ink-soft">
          Plan the session, get the route. Tell us what you&rsquo;re running and where you
          start — we find quiet, suitable ground and hand you a GPX for your watch.
        </p>
      </header>
      <Planner />
    </main>
  )
}
