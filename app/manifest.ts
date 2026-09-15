import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Nyashavee School Management",
    short_name: "Nyashavee",
    description: "School management system for Zimbabwean primary schools — admissions to graduation.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f9f8",
    theme_color: "#173f35",
    icons: [
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
