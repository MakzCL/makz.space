import type { FrameRecord } from "@/types";

const IB = "https://i.ibb.co";

/**
 * FRAMES — poster work and stills. The viewer treats these as artwork:
 * contained inside a frame, never cropped, metadata alongside.
 */
export const FRAMES: FrameRecord[] = [
  {
    slug: "nissan-gtr-r35",
    index: "01",
    title: "R35",
    subject: "Nissan GT-R R35",
    series: "Machines",
    year: "2025",
    medium: "Poster — digital",
    asset: {
      src: `${IB}/0y9Hy7h5/NISSAN-GTR-R35-POS.png`,
      alt: "Nissan GT-R R35 poster design",
      aspect: "2 / 3",
      fit: "contain",
    },
  },
  {
    slug: "yamaha-mt-125",
    index: "02",
    title: "MT-125",
    subject: "Yamaha MT-125",
    series: "Machines",
    year: "2025",
    medium: "Poster — digital",
    asset: {
      src: `${IB}/2YRcXvzq/YAMAHA-MT-125-POS.png`,
      alt: "Yamaha MT-125 poster design",
      aspect: "2 / 3",
      fit: "contain",
    },
  },
  {
    slug: "suzuki-gsx8r",
    index: "03",
    title: "GSX-8R",
    subject: "Suzuki GSX-8R",
    series: "Machines",
    year: "2025",
    medium: "Poster — digital",
    asset: {
      src: `${IB}/QFFXMqH5/SUZUKI-GSX8-R-POS.png`,
      alt: "Suzuki GSX-8R poster design",
      aspect: "2 / 3",
      fit: "contain",
    },
  },
  {
    slug: "alfa-romeo-giulia",
    index: "04",
    title: "GIULIA",
    subject: "Alfa Romeo Giulia Touring",
    series: "Machines",
    year: "2025",
    medium: "Poster — digital",
    asset: {
      src: `${IB}/QjqJb4hh/ALFA-ROMEO-GIULA-TOURING-POS.png`,
      alt: "Alfa Romeo Giulia Touring poster design",
      aspect: "2 / 3",
      fit: "contain",
    },
  },
  {
    slug: "scania-500-s",
    index: "05",
    title: "500 S",
    subject: "Scania 500 S — convoy livery",
    series: "Convoy",
    year: "2025",
    medium: "Poster — digital",
    asset: {
      src: `${IB}/23ZB95W2/makz-scania-500-S.png`,
      alt: "Scania 500 S convoy poster",
      aspect: "16 / 10",
      fit: "contain",
    },
  },
  {
    slug: "studio-01",
    index: "06",
    title: "STUDIO",
    subject: "Broadcast setup",
    series: "Stills",
    year: "2025",
    medium: "Photograph",
    asset: {
      src: `${IB}/N2xTW6C0/makz-stam1.jpg`,
      alt: "Broadcast studio still",
      aspect: "3 / 2",
      fit: "cover",
    },
  },
  {
    slug: "studio-02",
    index: "07",
    title: "OVERLAY",
    subject: "Overlay pass",
    series: "Stills",
    year: "2025",
    medium: "Photograph",
    asset: {
      src: `${IB}/7Jm1Rmwt/makz-stam2.jpg`,
      alt: "Overlay pass still",
      aspect: "3 / 2",
      fit: "cover",
    },
  },
  {
    slug: "studio-03",
    index: "08",
    title: "LATE",
    subject: "Late session",
    series: "Stills",
    year: "2025",
    medium: "Photograph",
    asset: {
      src: `${IB}/nqwD0frf/makz-stam3.jpg`,
      alt: "Late session still",
      aspect: "3 / 2",
      fit: "cover",
    },
  },
  {
    slug: "irl-01",
    index: "09",
    title: "IRL I",
    subject: "IRL segment",
    series: "Stills",
    year: "2025",
    medium: "Photograph",
    asset: {
      src: `${IB}/vCgJ75ks/makz-sp-1.jpg`,
      alt: "IRL stream still",
      aspect: "3 / 2",
      fit: "cover",
    },
  },
  {
    slug: "irl-02",
    index: "10",
    title: "IRL II",
    subject: "Build session",
    series: "Stills",
    year: "2025",
    medium: "Photograph",
    asset: {
      src: `${IB}/7tSCzHkb/makz-sp-2.jpg`,
      alt: "Build session still",
      aspect: "3 / 2",
      fit: "cover",
    },
  },
];

export const FRAME_SERIES = ["All", "Machines", "Convoy", "Stills"] as const;
export type FrameSeries = (typeof FRAME_SERIES)[number];

export function getFrame(slug: string) {
  return FRAMES.find((frame) => frame.slug === slug);
}
