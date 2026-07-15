'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import {
  projectSlugs,
  type Project,
  type ProjectSlug,
} from '@/lib/site-content';

import ProjectCard from './ProjectCard';
import styles from './ProjectGallery.module.css';

type ProjectGalleryProps = {
  projects: Project[];
};

type PendingFinalTarget = {
  slug: ProjectSlug;
  generation: number;
};

const SCROLL_INTENT_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
]);
const FINAL_SCROLL_QUIET_FRAMES = 3;
const FINAL_SCROLL_MAX_FRAMES = 120;

function scrollToProject(next: ProjectSlug) {
  const target = document.getElementById(next);
  if (!target) {
    return;
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  target.scrollIntoView({
    block: 'start',
    behavior: reducedMotion.matches ? 'auto' : 'smooth',
  });
}

function listenForScrollIntent(onIntent: () => void) {
  const handleIntent = () => onIntent();
  const handleKeyDown = (event: KeyboardEvent) => {
    if (SCROLL_INTENT_KEYS.has(event.key)) {
      onIntent();
    }
  };

  window.addEventListener('wheel', handleIntent, { passive: true });
  window.addEventListener('touchstart', handleIntent, { passive: true });
  window.addEventListener('pointerdown', handleIntent, { passive: true });
  window.addEventListener('keydown', handleKeyDown);

  return () => {
    window.removeEventListener('wheel', handleIntent);
    window.removeEventListener('touchstart', handleIntent);
    window.removeEventListener('pointerdown', handleIntent);
    window.removeEventListener('keydown', handleKeyDown);
  };
}

export default function ProjectGallery({ projects }: ProjectGalleryProps) {
  const [openSlug, setOpenSlug] = useState<ProjectSlug | null>(null);
  const pendingTargetTop = useRef<number | null>(null);
  const presenceSlugs = useRef<Set<ProjectSlug>>(new Set());
  const openSlugRef = useRef<ProjectSlug | null>(null);
  const navigationGeneration = useRef(0);
  const pendingFinalTarget = useRef<PendingFinalTarget | null>(null);
  const finalScrollFrame = useRef<number | null>(null);
  const removeIntentListeners = useRef<(() => void) | null>(null);

  const cancelPendingFinalScroll = useCallback(() => {
    if (finalScrollFrame.current !== null) {
      cancelAnimationFrame(finalScrollFrame.current);
      finalScrollFrame.current = null;
    }
    removeIntentListeners.current?.();
    removeIntentListeners.current = null;
    pendingFinalTarget.current = null;
  }, []);

  const settlePendingFinalScroll = useCallback(() => {
    const pending = pendingFinalTarget.current;
    if (!pending) {
      return;
    }
    if (
      pending.generation !== navigationGeneration.current
      || pending.slug !== openSlugRef.current
    ) {
      cancelPendingFinalScroll();
      return;
    }

    const hasStalePresence = [...presenceSlugs.current].some(
      (slug) => slug !== pending.slug,
    );
    const targetMounted = presenceSlugs.current.has(pending.slug);
    if (hasStalePresence || !targetMounted || finalScrollFrame.current !== null) {
      return;
    }

    let frames = 0;
    let quietFrames = 0;
    let previous: { height: number; scrollHeight: number } | null = null;
    const scheduleStableFrame = () => {
      finalScrollFrame.current = requestAnimationFrame(() => {
        finalScrollFrame.current = null;
        const latest = pendingFinalTarget.current;
        if (!latest) {
          return;
        }
        if (
          latest.generation !== navigationGeneration.current
          || latest.slug !== openSlugRef.current
        ) {
          cancelPendingFinalScroll();
          return;
        }
        const stalePresenceReturned = [...presenceSlugs.current].some(
          (slug) => slug !== latest.slug,
        );
        const targetStillMounted = presenceSlugs.current.has(latest.slug);
        if (stalePresenceReturned || !targetStillMounted) {
          return;
        }

        const target = document.getElementById(latest.slug);
        if (!target) {
          return;
        }
        const rect = target.getBoundingClientRect();
        const current = {
          height: rect.height,
          scrollHeight: document.documentElement.scrollHeight,
        };
        const unchanged = previous
          && Math.abs(current.height - previous.height) < 0.5
          && Math.abs(current.scrollHeight - previous.scrollHeight) < 0.5;
        quietFrames = unchanged ? quietFrames + 1 : 0;
        frames += 1;
        previous = current;
        const layoutStable = quietFrames >= FINAL_SCROLL_QUIET_FRAMES;
        const frameLimitReached = frames >= FINAL_SCROLL_MAX_FRAMES;
        if (!layoutStable && !frameLimitReached) {
          scheduleStableFrame();
          return;
        }

        pendingFinalTarget.current = null;
        removeIntentListeners.current?.();
        removeIntentListeners.current = null;
        scrollToProject(latest.slug);
      });
    };
    scheduleStableFrame();
  }, [cancelPendingFinalScroll]);

  const handlePresenceChange = useCallback((slug: ProjectSlug, mounted: boolean) => {
    if (mounted) {
      presenceSlugs.current.add(slug);
    } else {
      presenceSlugs.current.delete(slug);
    }
    settlePendingFinalScroll();
  }, [settlePendingFinalScroll]);

  function rememberProjectPosition(slug: ProjectSlug | null) {
    pendingTargetTop.current = slug
      ? document.getElementById(slug)?.getBoundingClientRect().top ?? null
      : null;
  }

  useEffect(() => {
    const syncFromHash = () => {
      const slug = window.location.hash.slice(1);
      const nextSlug = projectSlugs.includes(slug as ProjectSlug)
        ? (slug as ProjectSlug) : null;

      rememberProjectPosition(nextSlug);
      setOpenSlug(nextSlug);
    };

    syncFromHash();
    window.addEventListener('hashchange', syncFromHash);
    return () => window.removeEventListener('hashchange', syncFromHash);
  }, []);

  useLayoutEffect(() => {
    openSlugRef.current = openSlug;
    if (!openSlug) {
      pendingTargetTop.current = null;
      return;
    }

    const target = document.getElementById(openSlug);
    const previousTop = pendingTargetTop.current;
    pendingTargetTop.current = null;
    if (!target || previousTop === null) {
      return;
    }

    const currentTop = target.getBoundingClientRect().top;
    const scrollMarginTop = Number.parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
    const wasVisible = previousTop >= scrollMarginTop && previousTop < window.innerHeight;
    const preservedTop = wasVisible ? previousTop : scrollMarginTop;
    window.scrollBy({
      top: currentTop - preservedTop,
      behavior: 'auto',
    });
  }, [openSlug]);

  useEffect(() => {
    const generation = ++navigationGeneration.current;
    cancelPendingFinalScroll();
    if (!openSlug) {
      return;
    }

    let immediateScrollFrame: number | null = null;
    const hasStalePresence = [...presenceSlugs.current].some(
      (slug) => slug !== openSlug,
    );
    if (hasStalePresence || !presenceSlugs.current.has(openSlug)) {
      pendingFinalTarget.current = { slug: openSlug, generation };
      removeIntentListeners.current = listenForScrollIntent(() => {
        if (pendingFinalTarget.current?.generation === generation) {
          cancelPendingFinalScroll();
        }
      });
      settlePendingFinalScroll();
    } else {
      immediateScrollFrame = requestAnimationFrame(() => {
        immediateScrollFrame = null;
        if (
          generation === navigationGeneration.current
          && openSlug === openSlugRef.current
        ) {
          scrollToProject(openSlug);
        }
      });
    }

    return () => {
      if (immediateScrollFrame !== null) {
        cancelAnimationFrame(immediateScrollFrame);
      }
      if (pendingFinalTarget.current?.generation === generation) {
        cancelPendingFinalScroll();
      }
      window.scrollTo({
        top: window.scrollY,
        behavior: 'auto',
      });
    };
  }, [cancelPendingFinalScroll, openSlug, settlePendingFinalScroll]);

  function toggle(slug: ProjectSlug) {
    const next = openSlug === slug ? null : slug;

    rememberProjectPosition(next);
    setOpenSlug(next);
    history.replaceState(null, '', next ? `/works#${next}` : '/works');
  }

  return (
    <div className={styles.gallery}>
      {projects.map((project) => (
        <ProjectCard
          key={project.slug}
          project={project}
          expanded={openSlug === project.slug}
          onToggle={() => toggle(project.slug)}
          onPresenceChange={handlePresenceChange}
        />
      ))}
    </div>
  );
}
