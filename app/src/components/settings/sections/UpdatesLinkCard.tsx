import { ChevronRight } from "lucide-react";
import { observer } from "mobx-react-lite";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { openSettingsSection } from "@/lib/settings-route";
import { updateStatusSummary } from "@/lib/update-summary";

/** Cloudflare settings: one-line version summary with a link to Settings › Updates. */
export const UpdatesLinkCard = observer(function UpdatesLinkCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dotnote version</CardTitle>
        <CardDescription>{updateStatusSummary()}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button size="sm" variant="outline" onClick={() => openSettingsSection("update")}>
          Open Updates
          <ChevronRight className="size-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
});
