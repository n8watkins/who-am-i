// The public page behind a shared result link (/s/:id). The Worker has already put the card into
// the page's link-preview tags; this shows the card and invites the visitor to play.
import { useEffect, useState } from "react";
import type { PublicCard } from "../../kit/shared/share-cards";
import { Button, Card, Shell, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { navigate } from "../lib/router";

export function SharedResult({ id }: { id: string }) {
  const [card, setCard] = useState<PublicCard | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .sharedCard(id)
      .then((c) => !cancelled && setCard(c))
      .catch(() => !cancelled && setMissing(true));
    return () => {
      cancelled = true;
    };
  }, [id]);

  const play = (
    <div className="flex flex-col gap-3 sm:flex-row">
      <Button size="lg" block onClick={() => navigate("/new")}>
        Play Who Am I?
      </Button>
      <Button size="lg" variant="secondary" block onClick={() => navigate("/")}>
        How it works
      </Button>
    </div>
  );

  if (missing) {
    return (
      <Shell>
        <Card className="mt-6 text-center">
          <h1 className="text-2xl font-extrabold">This result is not shared</h1>
          <p className="mt-2 text-muted">The player stopped sharing it, or the link has expired.</p>
          <div className="mt-6">{play}</div>
        </Card>
      </Shell>
    );
  }
  if (!card) return <Shell><Spinner label="Loading the result" /></Shell>;

  return (
    <Shell>
      <div className="space-y-5">
        <h1 className="text-balance text-3xl font-extrabold tracking-tight" data-testid="shared-title">
          {/* Keep a score like "5-3" on one line. */}
          {card.title.split(/(\d+-\d+)/).map((part, i) => (i % 2 ? <span key={i} className="whitespace-nowrap">{part}</span> : part))}
        </h1>
        <img
          src={card.imageUrl}
          alt={card.title}
          width={1200}
          height={630}
          className="aspect-[1200/630] w-full rounded-3xl border border-line bg-card shadow-sm"
          data-testid="shared-card"
        />
        <p className="text-muted">{card.description}</p>
        {play}
      </div>
    </Shell>
  );
}
