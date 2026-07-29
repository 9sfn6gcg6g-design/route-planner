import Planner from './planner'

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-5 py-12 sm:py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Route Planner</h1>
        <p className="text-sm opacity-70">
          Plan the session, get the route. Tell us what you&rsquo;re running and where you
          start — we find quiet, suitable ground and hand you a GPX for your watch.
        </p>
      </header>
      <Planner />
    </main>
  )
}
