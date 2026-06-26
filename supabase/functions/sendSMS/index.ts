import "@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(async (req) => {
  try {
    const { phone, message } = await req.json();

    const apiKey = Deno.env.get("TEXTBEE_API_KEY");
    const deviceId = Deno.env.get("TEXTBEE_DEVICE_ID");

    if (!apiKey || !deviceId) {
      return new Response(
        JSON.stringify({
          error: "Missing TextBee credentials",
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    }

    // Convert 09xxxxxxxxx to +639xxxxxxxxx
    let recipient = phone;

    if (recipient.startsWith("09")) {
      recipient = "+63" + recipient.substring(1);
    }

    const response = await fetch(
      `https://api.textbee.dev/api/v1/gateway/devices/${deviceId}/send-sms`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          recipients: [recipient],
          message: message,
        }),
      }
    );

    const result = await response.text();

    return new Response(result, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: String(err),
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
  }
});