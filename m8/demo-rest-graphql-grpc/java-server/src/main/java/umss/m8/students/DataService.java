package umss.m8.students;

import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicLong;
import org.springframework.stereotype.Service;

// Copia fiel de src/data.service.ts: mismos datos, misma formula y la misma "base simulada"
// (DB_LATENCY_MS por consulta, como maximo DB_POOL consultas a la vez, las demas esperan en orden de llegada).
@Service
public class DataService {

    // El orden de campos se fija a mano: Jackson 3 ordena alfabeticamente por defecto y el JSON debe ser
    // identico byte a byte al de Node (id, name, email, career, courses).
    @JsonPropertyOrder({"id", "name", "email", "career"})
    public record Student(int id, String name, String email, String career) {}

    @JsonPropertyOrder({"code", "title"})
    public record Course(String code, String title) {}

    @JsonPropertyOrder({"id", "name", "email", "career", "courses"})
    public record StudentWithCourses(int id, String name, String email, String career, List<Course> courses) {}

    static final int TOTAL_STUDENTS = 2000;
    static final int TOTAL_COURSES = 200;
    static final int COURSES_PER_STUDENT = 5;

    private static final String[] FIRST_NAMES = {"Ana", "Luis", "Carla", "Diego", "Marta", "Jorge", "Lucia", "Pedro", "Sofia", "Marco"};
    private static final String[] LAST_NAMES = {"Rojas", "Mamani", "Quispe", "Vargas", "Flores", "Gomez", "Herrera", "Salazar", "Condori", "Arce"};
    private static final String[] CAREERS = {"Sistemas", "Informatica", "Electronica", "Industrial", "Civil"};

    private final List<Student> students = new ArrayList<>(TOTAL_STUDENTS);
    private final long latencyNs = (long) (Double.parseDouble(env("DB_LATENCY_MS", "1")) * 1_000_000);
    private final Semaphore pool = new Semaphore(Integer.parseInt(env("DB_POOL", "10")), true); // FIFO, como en Node
    private final AtomicLong queries = new AtomicLong();
    private final PreciseSleeper sleeper = new PreciseSleeper("sleep".equals(env("DB_WAIT", "precise")));

    public DataService() {
        for (int id = 1; id <= TOTAL_STUDENTS; id++) {
            String first = FIRST_NAMES[id % FIRST_NAMES.length];
            String last = LAST_NAMES[(id * 3) % LAST_NAMES.length];
            students.add(new Student(id, first + " " + last + " " + id,
                    (first + "." + last + "." + id + "@estudiantes.umss.edu").toLowerCase(Locale.ROOT),
                    CAREERS[id % CAREERS.length]));
        }
    }

    private static String env(String name, String def) {
        String v = System.getenv(name);
        return v == null || v.isBlank() ? def : v;
    }

    public long queryCount() {
        return queries.get();
    }

    public void resetQueryCount() {
        queries.set(0);
    }

    public Student findStudent(int id) {
        query();
        return id >= 1 && id <= TOTAL_STUDENTS ? students.get(id - 1) : null;
    }

    public List<Student> listStudents(int limit) {
        query();
        return students.subList(0, Math.min(Math.max(limit, 0), TOTAL_STUDENTS));
    }

    public List<Course> coursesOf(int studentId) {
        query();
        return buildCourses(studentId);
    }

    // Una sola consulta para varios estudiantes (lo que usan ?expand=courses y withCourses).
    public List<List<Course>> coursesOfMany(List<Integer> studentIds) {
        query();
        List<List<Course>> out = new ArrayList<>(studentIds.size());
        for (int id : studentIds) out.add(buildCourses(id));
        return out;
    }

    private static List<Course> buildCourses(int studentId) {
        List<Course> out = new ArrayList<>(COURSES_PER_STUDENT);
        for (int k = 0; k < COURSES_PER_STUDENT; k++) {
            int n = (studentId * 7 + k * 13) % TOTAL_COURSES;
            String padded = n < 10 ? "00" + n : n < 100 ? "0" + n : String.valueOf(n); // padStart(3, '0')
            out.add(new Course("CUR-" + padded, "Curso numero " + n));
        }
        return out;
    }

    private void query() {
        queries.incrementAndGet();
        pool.acquireUninterruptibly();
        try {
            if (latencyNs > 0) sleeper.sleep(latencyNs);
        } finally {
            pool.release();
        }
    }

    public void shutdown() {
        sleeper.close();
    }
}
