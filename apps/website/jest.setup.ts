import "@testing-library/jest-dom";

// Server-side config the renderer reads at module load. Never a real token in tests.
process.env.API_BASE_URL ??= "https://api.test.invalid/api/v1";
process.env.WEBSITE_MACHINE_TOKEN ??= "test-machine-token";
process.env.NEXT_PUBLIC_PLATFORM_DOMAIN ??= "schoolhub.test";
process.env.REVALIDATE_WEBHOOK_SECRET ??= "test-webhook-secret";
