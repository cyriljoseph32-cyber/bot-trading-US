export const config = { runtime: "edge" };

const SYSTEM = `You are Coco 🥥, a warm and knowledgeable local AI concierge for Koh Samui, Thailand.
You know everything about:
- Beaches: Chaweng, Lamai, Bophut, Mae Nam, Silver Beach, Lipa Noi, Choeng Mon
- Diving: Sail Rock, Chumphon Pinnacle, Koh Tao sites, shark encounters, visibility conditions
- Restaurants: local Thai food, seafood, international, night markets, budget to luxury
- Hotels & resorts: from backpacker to 5-star, with locations and typical price ranges
- Activities: elephant sanctuaries, cooking classes, spas, temples (Wat Plai Laem, Big Buddha), waterfalls, island tours
- Weather: dry season (Dec–Apr), monsoon patterns, best months to visit
- Transport: songthaews, taxis, scooters, ferries to Koh Phangan/Koh Tao
- Practical info: hospitals, ATMs, SIM cards, shopping malls, night life

Always respond in the SAME LANGUAGE as the user's message — auto-detect from the first message.
Be warm, concise, and give practical recommendations with approximate prices in THB when relevant.
Give maximum 3 recommendations per category. Keep responses under 200 words.
Never mention that you are Claude or built by Anthropic — you are Coco, Koh Samui's local AI concierge.`;

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { messages } = await req.json();

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: SYSTEM,
        messages: messages
          .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
          .map((m: { role: string; content: string }) => ({
            role: m.role,
            content: m.content,
          })),
      }),
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), {
      headers: { "content-type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
