const fs = require("fs");

function updateTest(filePath) {
  let content = fs.readFileSync(filePath, "utf8");
  content = content.replace(
    /\(useStore as unknown as ReturnType<typeof vi\.fn>\)\.mockReturnValue\(\{([\s\S]*?)\}\);/g,
    `(useStore as unknown as ReturnType<typeof vi.fn>).mockImplementation((selector: any) => {
      const state = {$1};
      return selector ? selector(state) : state;
    });`,
  );
  fs.writeFileSync(filePath, content);
}

updateTest("__tests__/components/Playlist.test.tsx");
updateTest("__tests__/components/Participants.test.tsx");
