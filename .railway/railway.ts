import { defineRailway, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "portalverse-server";
export default defineRailway(() => {
  const portalverseServer = service("portalverse-server", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "packages/server/Dockerfile" },
    healthcheck: "/api/health",
    healthcheckTimeout: 60,
    replicas: { "us-west2": 1 },
  });

  return project("portalverse", {
    variables: { managed: false },
    resources: [portalverseServer],
  });
});
