import { expect, test } from "bun:test";
import { siteIndex } from "./home";

test("home quick start follows the installed README", async () => {
    const readme = await Bun.file("node_modules/@dylanebert/shallot/README.md").text();
    const expected = readme.split("## quick start")[1]?.match(/```bash\n([\s\S]*?)```/)?.[1];
    expect(expected).toBeDefined();
    const section =
        siteIndex([], "test", "staging").split("<h2>quick start</h2>")[1]?.split("</section>")[0] ??
        "";
    const actual = [...section.matchAll(/<pre class="block">([\s\S]*?)<\/pre>/g)]
        .map((match) => match[1]?.replace(/<[^>]*>/g, ""))
        .join("\n\n");
    expect(actual.trim()).toBe(expected?.trim() ?? "");
});
