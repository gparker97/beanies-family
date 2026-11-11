package family.beanies.app.widget;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import org.json.JSONObject;

/**
 * The committed snapshot contract examples (src/utils/__tests__/fixtures/), shared by the reader
 * and fill tests so both read exactly the files the TypeScript builder pins.
 */
final class WidgetFixtures {

    private static final String FIXTURES = "src/utils/__tests__/fixtures/";

    private WidgetFixtures() {}

    /** A committed fixture, found by walking up from the test's working directory (android/app). */
    static JSONObject fixture(String name) throws Exception {
        File dir = new File(System.getProperty("user.dir")).getAbsoluteFile();
        while (dir != null) {
            File f = new File(dir, FIXTURES + name);
            if (f.isFile()) {
                return new JSONObject(new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8));
            }
            dir = dir.getParentFile();
        }
        throw new IOException("fixture not found above " + System.getProperty("user.dir") + ": " + name);
    }
}
