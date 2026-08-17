// Instagram block on the landing page.
//
// Two modes, and the page never has to know which it got:
//   live     — posts pulled from the Graph API, always the newest ones.
//   fallback — three hand-verified posts in Instagram's own iframe, used when
//              the feed is not configured yet or Meta is unreachable.
//
// The fallback exists because a social network being down must not leave a hole
// in the page, and because the site has to keep working in the window between
// deploying this and connecting the token.

import { captionHeadline, type InstagramPost } from './instagram';

export interface FallbackPost {
  code: string;
  caption: string;
}

function VideoBadge() {
  return (
    <span
      aria-hidden="true"
      className="absolute right-3 top-3 rounded-full bg-black/55 p-1.5 backdrop-blur-xs"
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4 text-white">
        <path d="M8 5.14v13.72L19 12 8 5.14Z" />
      </svg>
    </span>
  );
}

function LivePost({ post }: { post: InstagramPost }) {
  const headline = captionHeadline(post.caption);
  return (
    <a
      href={post.permalink}
      target="_blank"
      rel="noopener noreferrer"
      className="card card-lift group block overflow-hidden rounded-3xl bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-earth"
    >
      <div className="relative aspect-4/5 overflow-hidden bg-stone-100">
        {/*
          Deliberately a plain <img>, not next/image. Instagram's CDN URLs are
          signed and expire within days, so routing them through the image
          optimizer would cache a URL that dies and bill us for the privilege.
        */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={post.imageUrl}
          alt={headline ?? 'Publicación de Terrenalv en Instagram'}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
        {post.isVideo ? <VideoBadge /> : null}
      </div>
      <div className="p-4">
        <p className="text-sm font-semibold text-stone-700">
          {headline ?? 'Ver la publicación en Instagram'}
        </p>
        <p className="annot mt-2 text-stone-400">Ver en Instagram →</p>
      </div>
    </a>
  );
}

export function InstagramFeed({
  posts,
  fallback,
}: {
  posts: InstagramPost[] | null;
  fallback: FallbackPost[];
}) {
  if (posts?.length) {
    return (
      <div className="mt-5 grid gap-6 sm:grid-cols-3">
        {posts.map((p) => (
          <LivePost key={p.id} post={p} />
        ))}
      </div>
    );
  }

  return (
    <div className="mt-5 grid gap-6 sm:grid-cols-3">
      {fallback.map((p) => (
        <figure key={p.code} className="card card-lift rounded-3xl bg-white p-3">
          <div className="overflow-hidden rounded-2xl bg-stone-100">
            <iframe
              title={p.caption}
              src={`https://www.instagram.com/reel/${p.code}/embed/`}
              className="w-full border-0"
              style={{ height: 640 }}
              loading="lazy"
              scrolling="no"
              allow="encrypted-media; picture-in-picture; fullscreen"
            />
          </div>
          <figcaption className="mt-2 px-1 text-sm font-semibold text-stone-700">
            {p.caption}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}
