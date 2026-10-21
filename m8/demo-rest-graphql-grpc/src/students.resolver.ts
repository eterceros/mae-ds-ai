import { Args, Context, Int, Parent, Query, ResolveField, Resolver } from '@nestjs/graphql';
import DataLoader from 'dataloader';
import { Course, DataService, Student } from './data.service';

interface GqlContext {
  coursesLoader?: DataLoader<number, Course[]>;
}

@Resolver('Student')
export class StudentsResolver {
  constructor(private readonly data: DataService) {}

  @Query('student')
  student(@Args('id', { type: () => Int }) id: number) {
    return this.data.findStudent(id);
  }

  @Query('students')
  students(@Args('limit', { type: () => Int }) limit: number) {
    return this.data.listStudents(limit);
  }

  // Con dataloader: todas las peticiones de cursos del mismo ciclo se agrupan en una sola consulta.
  @ResolveField('courses')
  courses(@Parent() student: Student, @Context() ctx: GqlContext) {
    ctx.coursesLoader ??= new DataLoader<number, Course[]>((ids) => this.data.coursesOfMany(ids));
    return ctx.coursesLoader.load(student.id);
  }

  // Sin dataloader: una consulta por estudiante.
  @ResolveField('coursesNaive')
  coursesNaive(@Parent() student: Student) {
    return this.data.coursesOf(student.id);
  }
}
