import { Controller } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { from, mergeMap, Observable } from 'rxjs';
import { DataService, Student } from './data.service';

@Controller()
export class StudentsGrpcController {
  constructor(private readonly data: DataService) {}

  @GrpcMethod('StudentService', 'GetStudent')
  async getStudent({ id }: { id: number }) {
    const student = await this.data.findStudent(id);
    if (!student) throw new RpcException({ code: status.NOT_FOUND, message: `Estudiante ${id} no existe` });
    return student;
  }

  @GrpcMethod('StudentService', 'ListStudents')
  async listStudents({ limit, withCourses }: { limit: number; withCourses: boolean }) {
    const students = await this.data.listStudents(limit);
    if (!withCourses) return { students };
    const courses = await this.data.coursesOfMany(students.map((s) => s.id));
    return { students: students.map((s, i) => ({ ...s, courses: courses[i] })) };
  }

  // Streaming de servidor: un mensaje por estudiante, el cliente puede empezar a procesar el primero
  // sin esperar a los demas. Nest convierte el Observable en una respuesta en flujo.
  @GrpcMethod('StudentService', 'StreamStudents')
  streamStudents({ limit }: { limit: number }): Observable<Student> {
    return from(this.data.listStudents(limit)).pipe(mergeMap((students) => from(students)));
  }
}
