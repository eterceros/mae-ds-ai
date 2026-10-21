import { Controller } from '@nestjs/common';
import { GrpcMethod, RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';
import { DataService } from './data.service';

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
}
