import { render } from "@testing-library/react";
import { JsonLd } from "../json-ld";

describe("JsonLd", () => {
  it("keeps a </script> in a title inside the one structured-data script", () => {
    const headline = "Results day</script><script>window.pwned = true</script>";
    const { container } = render(<JsonLd data={{ "@type": "NewsArticle", headline }} />);

    const scripts = container.querySelectorAll("script");
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toHaveAttribute("type", "application/ld+json");
    expect(JSON.parse(scripts[0]?.textContent ?? "")).toEqual({ "@type": "NewsArticle", headline });
  });

  it("survives the HTML parser: the serialised markup holds no closing tag but its own", () => {
    const { container } = render(<JsonLd data={{ name: "</script><img src=x onerror=1>" }} />);

    // Re-parse the rendered HTML the way a browser receives it from the server.
    const reparsed = document.createElement("div");
    reparsed.innerHTML = container.innerHTML;
    expect(reparsed.querySelectorAll("script")).toHaveLength(1);
    expect(reparsed.querySelector("img")).toBeNull();
  });
});
