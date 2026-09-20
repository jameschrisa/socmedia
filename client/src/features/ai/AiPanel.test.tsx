import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockFetch, renderWithProviders } from "@/test-utils";
import { useAppStore } from "@/store/appStore";
import { useAiBridge } from "./aiBridge";
import { useAiStore } from "./aiStore";
import { AiPanel } from "./AiPanel";

function resetStores() {
  useAppStore.setState({
    currentOrgId: "org1",
    aiPanelOpen: true,
    composerOpen: false,
    composerPostId: null,
    composerDefaults: { scheduledAt: null, mediaIds: [] },
  });
  useAiBridge.setState({ pending: null, context: { brief: "", platforms: [], caption: "" } });
  useAiStore.setState({
    activeTab: "captions",
    lastMock: false,
    history: [],
    captionsResult: null,
    ideasResult: null,
    hashtagsResult: null,
    improveResult: null,
    captionsBriefSeed: null,
    improveSeed: null,
  });
}

const bestTimesRoute = { "POST /api/ai/best-times": () => ({ slots: [] }) };

beforeEach(() => {
  resetStores();
});

describe("AiPanel", () => {
  it("renders the four generation tabs", () => {
    mockFetch(bestTimesRoute);
    renderWithProviders(<AiPanel />);
    expect(screen.getByRole("tab", { name: "Captions" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Ideas" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Hashtags" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Improve" })).toBeInTheDocument();
  });

  it("renders nothing when the panel is closed", () => {
    mockFetch(bestTimesRoute);
    useAppStore.setState({ aiPanelOpen: false });
    renderWithProviders(<AiPanel />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("generates captions for the selected platforms/tone and shows char counts", async () => {
    const user = userEvent.setup();
    const { calls } = mockFetch({
      ...bestTimesRoute,
      "POST /api/ai/captions": () => ({
        variants: [{ platform: "instagram", caption: "Check this out!", hashtags: ["#launch"], hook: "Big news", charCount: 16 }],
        model: "mock-model",
        mock: false,
      }),
    });
    renderWithProviders(<AiPanel />);

    await user.type(screen.getByLabelText("Brief"), "Announce our launch");
    await user.click(screen.getByRole("button", { name: /^generate$/i }));

    await waitFor(() => expect(screen.getByText("Big news")).toBeInTheDocument());
    expect(screen.getByText("16 / 2200")).toBeInTheDocument();

    const call = calls.find((c) => c.url.includes("/ai/captions"));
    expect(call).toBeTruthy();
    const body = call!.body as { tone: string; platforms: string[] };
    expect(body.tone).toBe("professional");
    expect([...body.platforms].sort()).toEqual(["instagram", "linkedin", "tiktok", "x", "youtube"]);
  });

  it("sends a caption to the composer via Use in composer", async () => {
    const user = userEvent.setup();
    mockFetch({
      ...bestTimesRoute,
      "POST /api/ai/captions": () => ({
        variants: [{ platform: "instagram", caption: "Check this out!", hashtags: ["#launch"], hook: "Big news", charCount: 16 }],
        model: "m",
        mock: false,
      }),
    });
    renderWithProviders(<AiPanel />);

    await user.type(screen.getByLabelText("Brief"), "Announce our launch");
    await user.click(screen.getByRole("button", { name: /^generate$/i }));
    await waitFor(() => screen.getByText("Big news"));

    await user.click(screen.getByRole("button", { name: /use in composer/i }));

    expect(useAiBridge.getState().pending).toMatchObject({ kind: "caption", caption: "Check this out!" });
    expect(useAppStore.getState().composerOpen).toBe(true);
  });

  it("generates ideas and drafts one into the composer", async () => {
    const user = userEvent.setup();
    const { calls } = mockFetch({
      ...bestTimesRoute,
      "POST /api/ai/ideas": () => ({
        ideas: [{ title: "5 Tips", hook: "You won't believe #3", format: "square", platform: "instagram", outline: ["Tip one", "Tip two"], whyItWorks: "It's actionable" }],
        model: "m",
        mock: false,
      }),
    });
    renderWithProviders(<AiPanel />);

    await user.click(screen.getByRole("tab", { name: "Ideas" }));
    await user.type(screen.getByLabelText("Topic"), "Product launch");
    await user.click(screen.getByRole("button", { name: /^generate$/i }));

    await waitFor(() => screen.getByText("5 Tips"));

    await user.click(screen.getByRole("button", { name: /draft this/i }));

    expect(useAiBridge.getState().pending).toMatchObject({ kind: "idea", title: "5 Tips" });
    expect(useAppStore.getState().composerOpen).toBe(true);

    const call = calls.find((c) => c.url.includes("/ai/ideas"));
    expect((call!.body as { topic: string }).topic).toBe("Product launch");
  });

  it("generates hashtags and adds the selected ones to the composer", async () => {
    const user = userEvent.setup();
    mockFetch({
      ...bestTimesRoute,
      "POST /api/ai/hashtags": () => ({ hashtags: ["#one", "#two", "#three"], model: "m", mock: false }),
    });
    renderWithProviders(<AiPanel />);

    await user.click(screen.getByRole("tab", { name: "Hashtags" }));
    await user.type(screen.getByLabelText("Caption"), "Our new launch is here");
    await user.click(screen.getByRole("button", { name: /^generate$/i }));

    await waitFor(() => screen.getByText("one"));

    await user.click(screen.getByRole("button", { name: /add selected to composer/i }));

    expect(useAiBridge.getState().pending?.kind).toBe("hashtags");
    expect(useAiBridge.getState().pending?.hashtags).toEqual(expect.arrayContaining(["#one", "#two", "#three"]));
  });

  it("improves a caption and shows the improved text", async () => {
    const user = userEvent.setup();
    mockFetch({
      ...bestTimesRoute,
      "POST /api/ai/improve": () => ({ caption: "A much better caption", hashtags: ["#better"], model: "m", mock: false }),
    });
    renderWithProviders(<AiPanel />);

    await user.click(screen.getByRole("tab", { name: "Improve" }));
    await user.type(screen.getByLabelText("Caption"), "Meh caption");
    await user.click(screen.getByRole("button", { name: /^generate$/i }));

    await waitFor(() => expect(screen.getByText("A much better caption")).toBeInTheDocument());
  });

  it("shows the offline mock badge when a response was served by the mock", async () => {
    const user = userEvent.setup();
    mockFetch({
      ...bestTimesRoute,
      "POST /api/ai/captions": () => ({
        variants: [{ platform: "instagram", caption: "Check this out!", hashtags: [], hook: "Big news", charCount: 16 }],
        model: "m",
        mock: true,
      }),
    });
    renderWithProviders(<AiPanel />);

    await user.type(screen.getByLabelText("Brief"), "Announce our launch");
    await user.click(screen.getByRole("button", { name: /^generate$/i }));

    await waitFor(() => expect(screen.getByText(/offline mock/i)).toBeInTheDocument());
  });
});
