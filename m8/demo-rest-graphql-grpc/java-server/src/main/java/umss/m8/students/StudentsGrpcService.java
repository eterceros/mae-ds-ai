package umss.m8.students;

import io.grpc.Status;
import io.grpc.stub.StreamObserver;
import java.util.List;
import org.springframework.stereotype.Component;
import students.StudentServiceGrpc;
import students.Students;
import umss.m8.students.DataService.Course;
import umss.m8.students.DataService.Student;

// Mismo comportamiento que src/students.grpc.ts. Los mensajes protobuf se construyen en cada llamada a partir
// de los mismos objetos que usa REST, como hace Node: el costo de convertir y serializar entra en la medicion.
@Component
public class StudentsGrpcService extends StudentServiceGrpc.StudentServiceImplBase {

    private final DataService data;

    public StudentsGrpcService(DataService data) {
        this.data = data;
    }

    @Override
    public void getStudent(Students.GetStudentRequest request, StreamObserver<Students.Student> responseObserver) {
        Student s = data.findStudent(request.getId());
        if (s == null) {
            responseObserver.onError(Status.NOT_FOUND.withDescription("Estudiante " + request.getId() + " no existe").asRuntimeException());
            return;
        }
        responseObserver.onNext(toProto(s).build());
        responseObserver.onCompleted();
    }

    @Override
    public void listStudents(Students.ListStudentsRequest request, StreamObserver<Students.ListStudentsReply> responseObserver) {
        List<Student> students = data.listStudents(request.getLimit());
        Students.ListStudentsReply.Builder reply = Students.ListStudentsReply.newBuilder();
        if (!request.getWithCourses()) {
            for (Student s : students) reply.addStudents(toProto(s));
        } else {
            List<List<Course>> courses = data.coursesOfMany(students.stream().map(Student::id).toList());
            for (int i = 0; i < students.size(); i++) {
                Students.Student.Builder b = toProto(students.get(i));
                for (Course c : courses.get(i)) b.addCourses(Students.Course.newBuilder().setCode(c.code()).setTitle(c.title()));
                reply.addStudents(b);
            }
        }
        responseObserver.onNext(reply.build());
        responseObserver.onCompleted();
    }

    private static Students.Student.Builder toProto(Student s) {
        return Students.Student.newBuilder().setId(s.id()).setName(s.name()).setEmail(s.email()).setCareer(s.career());
    }
}
