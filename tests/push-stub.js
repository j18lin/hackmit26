// Loaded only by the API test subprocess. No notification leaves the machine.
import webpush from "web-push";
webpush.sendNotification = async (subscription, payload) => {
  const message = JSON.parse(payload);
  if (!message.title || !message.body)
    throw new Error("Push payload is missing content.");
  if (subscription.endpoint.endsWith("/gone"))
    throw Object.assign(new Error("Subscription expired"), { statusCode: 410 });
  if (subscription.endpoint.endsWith("/failure"))
    throw Object.assign(new Error("Temporary upstream error"), {
      statusCode: 503,
    });
  return { statusCode: 201 };
};
