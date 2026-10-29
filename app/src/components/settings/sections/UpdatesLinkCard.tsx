import { ChevronRight } from "lucide-react";
import { observer } from "mobx-react-lite";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNavigate } from "@/lib/next-router-compat";
import { settingsPath } from "@/routes/paths";
import { updateStatusSummary } from "@/lib/update-summary";

/** Cloudflare settings: one-line version summary with a link to Settings › Updates. */
export const UpdatesLinkCard = observer(function UpdatesLinkCard() {
  const navigate = useNavigate();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dotnote version</CardTitle>
        <CardDescription>{updateStatusSummary()}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button size="sm" variant="outline" onClick={() => navigate(settingsPath("update"))}>
          Open Updates
          <ChevronRight className="size-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
});
