package umss.m8.students;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import umss.m8.students.DataService.Course;
import umss.m8.students.DataService.Student;
import umss.m8.students.DataService.StudentWithCourses;

// Mismas rutas y mismas respuestas que src/students.controller.ts (Jackson, JSON compacto).
@RestController
public class StudentsController {

    private final DataService data;

    public StudentsController(DataService data) {
        this.data = data;
    }

    @GetMapping("/students/{id}")
    public ResponseEntity<?> getStudent(@PathVariable int id) {
        Student student = data.findStudent(id);
        if (student == null) {
            return ResponseEntity.status(404)
                    .body(Map.of("message", "Estudiante " + id + " no existe", "error", "Not Found", "statusCode", 404));
        }
        return ResponseEntity.ok(student);
    }

    // ?expand=courses devuelve los cursos en la misma respuesta (una consulta para todos).
    @GetMapping("/students")
    public List<?> listStudents(@RequestParam(defaultValue = "100") String limit, @RequestParam(required = false) String expand) {
        List<Student> students = data.listStudents(parseLimit(limit));
        if (!"courses".equals(expand)) return students;
        List<List<Course>> courses = data.coursesOfMany(students.stream().map(Student::id).toList());
        List<StudentWithCourses> out = new ArrayList<>(students.size());
        for (int i = 0; i < students.size(); i++) {
            Student s = students.get(i);
            out.add(new StudentWithCourses(s.id(), s.name(), s.email(), s.career(), courses.get(i)));
        }
        return out;
    }

    @GetMapping("/students/{id}/courses")
    public List<Course> coursesOf(@PathVariable int id) {
        return data.coursesOf(id);
    }

    @GetMapping("/stats")
    public Map<String, Long> stats() {
        return Map.of("dbQueries", data.queryCount());
    }

    @PostMapping("/stats/reset")
    public Map<String, Long> resetStats() {
        data.resetQueryCount();
        return Map.of("dbQueries", 0L);
    }

    // En Node, Number('abc') es NaN y la lista sale vacia; aqui, igual.
    private static int parseLimit(String limit) {
        try {
            return (int) Math.floor(Double.parseDouble(limit));
        } catch (NumberFormatException e) {
            return 0;
        }
    }
}
