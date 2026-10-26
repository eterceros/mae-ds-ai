// Fragmento de referencia (no se ejecuta). La corrección de BOLA en Spring.
package demo;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/orders")
public class OrdersController {

  // El token ya está validado (firma, iss, aud, exp) por el resource server; aquí solo se AUTORIZA.
  @GetMapping("/{id}")
  public ResponseEntity<Order> get(@PathVariable String id, @AuthenticationPrincipal Jwt jwt) {
    Order o = OrderRepository.find(id);
    // El dueño se identifica por "sub" (id estable del usuario), no por preferred_username.
    String sub = jwt.getSubject();
    // CORRECCIÓN (BOLA): el pedido tiene que ser del usuario autenticado; si no, 404 (no 403).
    if (o == null || !o.owner().equals(sub)) {
      return ResponseEntity.notFound().build();
    }
    return ResponseEntity.ok(o);
  }
}
