const handler = {
    async fetch(request: Request): Promise<Response> {
      try {
        const { messages, apiKey } = await request.json();

        if (!apiKey) {
          return new Response(JSON.stringify({ message: "The API key is incorrect or not set." }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const response = await fetch("https://api.cloudflare.com/client/v4/accounts/e2fa0631e7c2fafc79e68a70a5968569/ai/run/@cf/meta/llama-2-7b-chat", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ messages }),
        });

        if (!response.ok) {
          throw new Error("Failed to fetch AI response");
        }

        const { result } = await response.json();

        return new Response(JSON.stringify({ message: result }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });

      } catch (error) {
        return new Response(JSON.stringify({ message: "An error occurred" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
    },
  };

  export default handler;
// export default {
//     async fetch(request) {
//       try {
//         const { messages, apiKey } = await request.json();

//         if (!apiKey) {
//           return new Response(JSON.stringify({ message: "The API key is incorrect or not set." }), {
//             status: 400,
//             headers: { "Content-Type": "application/json" },
//           });
//         }

//         const response = await fetch("https://api.cloudflare.com/client/v4/accounts/e2fa0631e7c2fafc79e68a70a5968569/ai/run/@cf/meta/llama-2-7b-chat", {
//           method: "POST",
//           headers: {
//             "Authorization": `Bearer ${apiKey}`,
//             "Content-Type": "application/json",
//           },
//           body: JSON.stringify({ messages }),
//         });

//         if (!response.ok) {
//           throw new Error("Failed to fetch AI response");
//         }

//         const { result } = await response.json();

//         return new Response(JSON.stringify({ message: result }), {
//           status: 200,
//           headers: { "Content-Type": "application/json" },
//         });

//       } catch (error) {
//         return new Response(JSON.stringify({ message: "An error occurred" }), {
//           status: 500,
//           headers: { "Content-Type": "application/json" },
//         });
//       }
//     },
// };
