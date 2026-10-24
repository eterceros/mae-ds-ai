// =====================================================================================
//  EQUIVALENTE EN SPRING: NO MEDIDO. No se compiló ni se corrió contra esta demo.
//  Muestra cómo se escriben en Java las mismas protecciones que A tiene en Node.
//  Supone Spring Boot 4 (Spring Framework 7) y io.github.resilience4j:resilience4j-spring-boot4:2.4.0
//  (más spring-boot-starter-aop o el starter de AOP que corresponda a su versión [por verificar]).
// =====================================================================================
package demo.resiliencia;

import io.github.resilience4j.bulkhead.annotation.Bulkhead;
import io.github.resilience4j.circuitbreaker.annotation.CircuitBreaker;
import java.net.http.HttpClient;
import java.time.Duration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.resilience.annotation.ConcurrencyLimit;
import org.springframework.resilience.annotation.EnableResilientMethods;
import org.springframework.resilience.annotation.Retryable;
import org.springframework.stereotype.Service;
import org.springframework.web.client.HttpServerErrorException;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

@Configuration
@EnableResilientMethods // activa @Retryable y @ConcurrencyLimit de Spring Framework 7
class ConfigB {

  // Timeouts (R2): de conexión y de lectura. Ojo: el de lectura es "entre bytes", no un plazo
  // total como AbortSignal.timeout; para un plazo total, Resilience4j tiene @TimeLimiter (asíncrono).
  @Bean
  RestClient clienteB(RestClient.Builder builder) {
    HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofMillis(200)).build();
    JdkClientHttpRequestFactory fabrica = new JdkClientHttpRequestFactory(http);
    fabrica.setReadTimeout(Duration.ofMillis(300));
    return builder.baseUrl("http://toxiproxy:8666").requestFactory(fabrica).build();
  }
}

@Service
class ClienteB {

  private final RestClient b;

  ClienteB(RestClient clienteB) {
    this.b = clienteB;
  }

  // R3: reintentos con backoff exponencial y jitter, SOLO porque es un GET (idempotente).
  // maxRetries = 2 -> 3 intentos en total. delay/maxDelay/jitter en ms.
  // Diferencia con la demo: según la documentación de Spring 7, el jitter suma un retardo al azar
  // de 0 a min(jitter, maxDelay); no es el "jitter completo" de la demo (0 a todo el exponencial).
  // Sin "includes" reintenta ante CUALQUIER excepción; aquí, solo timeouts/red y 5xx.
  @Retryable(
      includes = {ResourceAccessException.class, HttpServerErrorException.class},
      maxRetries = 2,
      delay = 50,
      multiplier = 2,
      maxDelay = 1000,
      jitter = 50)
  public String datosConReintentos() {
    return b.get().uri("/datos").retrieve().body(String.class);
  }

  // R5: circuit breaker. Spring Framework 7 NO trae circuit breaker: se usa Resilience4j 2.4.
  // La configuración (umbral 50 %, mínimo 10 llamadas, ventana, 2 s abierto) va en application.yml, abajo.
  @CircuitBreaker(name = "b", fallbackMethod = "sinB")
  public String datosConBreaker() {
    return b.get().uri("/datos").retrieve().body(String.class);
  }

  // Se llama si B falla o si el circuito está abierto (CallNotPermittedException): responder rápido.
  String sinB(Throwable causa) {
    throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "B no disponible", causa);
  }

  // R6, opción 1: @ConcurrencyLimit de Spring 7. Ojo: al llegar al límite el hilo ESPERA
  // (como un pool que se llena), no se rechaza al instante como en la demo.
  @ConcurrencyLimit(10)
  public String datosLentosEsperando() {
    return b.get().uri("/datos").retrieve().body(String.class);
  }

  // R6, opción 2: bulkhead de Resilience4j con max-wait-duration 0 (rechaza al instante,
  // BulkheadFullException), que es lo que hace la demo.
  @Bulkhead(name = "bLento", fallbackMethod = "sinB")
  public String datosLentosRechazando() {
    return b.get().uri("/datos").retrieve().body(String.class);
  }
}

/* application.yml (Resilience4j 2.4):

resilience4j:
  circuitbreaker:
    instances:
      b:
        sliding-window-type: TIME_BASED     # como opossum: ventana por tiempo...
        sliding-window-size: 2              # ...de 2 s (en Resilience4j el valor por omisión es COUNT_BASED, 100 llamadas)
        minimum-number-of-calls: 10
        failure-rate-threshold: 50
        wait-duration-in-open-state: 2s
        permitted-number-of-calls-in-half-open-state: 1
        slow-call-duration-threshold: 500ms # una llamada más lenta que esto cuenta como mala...
        slow-call-rate-threshold: 50        # ...y si el 50 % son lentas, también abre
  bulkhead:
    instances:
      bLento:
        max-concurrent-calls: 10
        max-wait-duration: 0
*/
