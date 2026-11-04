import { Button, Card, Shell } from "./components/ui";
import { navigate, useRoute } from "./lib/router";
import { Create } from "./screens/Create";
import { JoinCode } from "./screens/JoinCode";
import { Landing } from "./screens/Landing";
import { RoomPage } from "./screens/Room";

export function App() {
  const route = useRoute();
  switch (route.name) {
    case "landing":
      return <Landing />;
    case "create":
      return <Create />;
    case "join":
      return <JoinCode />;
    case "room":
      return <RoomPage key={route.code} code={route.code} />;
    default:
      return (
        <Shell>
          <Card className="mt-6 text-center">
            <h1 className="text-2xl font-extrabold">Page not found</h1>
            <div className="mt-6">
              <Button onClick={() => navigate("/")}>Go home</Button>
            </div>
          </Card>
        </Shell>
      );
  }
}
